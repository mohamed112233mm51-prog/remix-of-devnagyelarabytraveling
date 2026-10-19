import type { ImportSpec } from "./specs.ts";
import { preparePassengerImport, type PassengerContext } from "../passengerClassification.ts";

/** Execution imports use the same saved option IDs and exact active labels as forms/pricing. */
export function withPassengerClassificationSpec(spec: ImportSpec, context?: PassengerContext): ImportSpec {
  if (spec.id !== "executions") return spec;
  return {
    ...spec,
    fields: spec.fields.map(field => field.key === "passenger_type" ? { ...field, enum: undefined } : field),
    transformRow: row => {
      if (!context) throw new Error("انتظر تحميل إعدادات نوع المسافر ثم أعد المحاولة.");
      return preparePassengerImport(row, context);
    },
  };
}
