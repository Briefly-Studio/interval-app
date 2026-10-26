import AsyncStorage from "@react-native-async-storage/async-storage";
import { createGeneratedCardProvenanceStore } from "./generatedCardProvenanceStore";

// Native adapter only; all lifecycle/migration/serialization logic is injected and Node-testable.
const store = createGeneratedCardProvenanceStore(AsyncStorage);
export const getGeneratedCardProvenance = store.get;
export const getProvenanceForSource = store.forSource;
export const getProvenanceForCard = store.byCard;
export const recordGeneratedCardProvenance = store.record;
export const applyGeneratedCardProvenance = store.apply;
export const markGeneratedCardProvenanceClean = store.markClean;
export const setGeneratedCardProvenanceDeleted = store.setDeleted;
