import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});

const BUCKET = process.env.LIBRARY_SOURCE_BUCKET;

// Short-lived transport credential, not a durable reference — see docs/library-cloud-sync-contract.md's
// "durable cloud reference vs local transport state" distinction. Never persisted by the client.
const URL_TTL_SECONDS = 300;

// Conservative Development limit, chosen deliberately, not derived from any real constraint.
// Raise only as a deliberate documented change — see docs/library-and-source-architecture.md.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Matches the REAL canonical id shape this app generates — src/models/deck.ts's makeId()
// (`<base36 timestamp>-<base36 random>`, e.g. "mst3f9k2-8h2p1qte"), which every id-generating call
// site in the app imports, Library sources included. An earlier version of this pattern
// (`^[a-z0-9_]{1,128}$`, no hyphen) was based on a different, unused underscore-based id generator
// and rejected every real Library source id — see docs/library-and-source-architecture.md's
// "Local file URI rule and local source file durability" for the full incident record. Anchoring
// the object-key namespace to a known-safe charset (still lowercase alphanumeric and hyphen only)
// means a source id can never smuggle a path-traversal segment ("../") or an unexpected "/" into
// an S3 key built from it.
const SOURCE_ID_PATTERN = /^[a-z0-9-]{1,128}$/;

// Conservative allow-list mirroring src/models/librarySource.ts's SourceType union, minus audio —
// no audio file-intake UI exists yet (see docs/library-and-source-architecture.md's "Supported
// input scope" note), so there is nothing to justify accepting an audio upload in this batch.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Supports HTTP API (v2) JWT authorizer AND REST API style authorizer — identical helper to
// backend/lambdas/sync-push/index.mjs and sync-pull/index.mjs; duplicated deliberately, no shared
// module exists between Lambdas in this repository (see docs/cdk-infrastructure.md).
function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

// Server-derived and server-controlled — the client never supplies or influences this key. Never
// includes anything from the request body, only the trusted JWT sub and the path-validated
// sourceId. This is the entire ownership boundary: a user can only ever request a URL scoped to
// their own `users/<their-sub>/...` prefix, enforced both here and by the Lambda's own IAM policy
// (see infra/lib/interval-sync-stack.ts's LibrarySourceObjectsOnly statement).
function objectKeyFor(sub, sourceId) {
  return `users/${sub}/sources/${sourceId}/original`;
}

export const handler = async (event) => {
  try {
    if (!BUCKET) {
      return resp(500, { error: "server-misconfigured" });
    }

    // Require auth (API Gateway's JWT authorizer should already enforce this, but double-lock —
    // same convention as sync-push/sync-pull).
    const sub = getUserSub(event);
    if (!sub) return resp(401, { error: "unauthorized" });

    const sourceId = event?.pathParameters?.sourceId;
    if (typeof sourceId !== "string" || !SOURCE_ID_PATTERN.test(sourceId)) {
      return resp(400, { error: "invalid-source-id" });
    }

    const objectKey = objectKeyFor(sub, sourceId);
    const routeKey = typeof event?.routeKey === "string" ? event.routeKey : "";

    if (routeKey.endsWith("/upload-url")) {
      let body;
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return resp(400, { error: "invalid-json" });
      }

      const mimeType = body?.mimeType;
      const fileSize = body?.fileSize;

      if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
        return resp(400, { error: "unsupported-mime-type" });
      }
      if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
        return resp(400, { error: "invalid-file-size" });
      }
      if (fileSize > MAX_UPLOAD_BYTES) {
        return resp(400, { error: "file-too-large" });
      }

      // ContentType is a SIGNED parameter here — S3 rejects the PUT if the client sends a
      // different Content-Type header than this, which is soft type enforcement, not a guarantee
      // about the actual byte content of the upload. Content-Length is deliberately NOT enforced
      // the same way: a presigned PUT (unlike a presigned POST policy's content-length-range
      // condition) cannot bind an exact byte-range constraint, so `fileSize` above is validated
      // only against the client's own declared value before a URL is even issued, never verified
      // against the real upload afterward. This is a documented enforcement boundary, not a
      // silent gap — see docs/library-and-source-architecture.md's "Size/type validation" note.
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, ContentType: mimeType }),
        { expiresIn: URL_TTL_SECONDS }
      );

      return resp(200, { objectKey, uploadUrl, expiresInSeconds: URL_TTL_SECONDS });
    }

    if (routeKey.endsWith("/download-url")) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        if (error?.name === "NotFound" || status === 404) {
          return resp(404, { error: "not-found" });
        }
        throw error;
      }

      const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }), {
        expiresIn: URL_TTL_SECONDS,
      });

      return resp(200, { downloadUrl, expiresInSeconds: URL_TTL_SECONDS });
    }

    return resp(404, { error: "unknown-route" });
  } catch (e) {
    console.log("[library-source-storage] unhandled error:", e?.name || "UnknownError");
    return resp(500, { error: "internal-error" });
  }
};
