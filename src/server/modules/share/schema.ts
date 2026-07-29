import { z } from "zod";

export const UpdatePublicShareInputSchema = z.object({
  enabled: z.boolean(),
}).strict();

export type UpdatePublicShareInput = z.infer<typeof UpdatePublicShareInputSchema>;
