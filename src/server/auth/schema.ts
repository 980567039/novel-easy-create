import { z } from "zod";

const EmailSchema = z.string().trim().email("邮箱格式不正确。").max(320, "邮箱过长。");
const PasswordSchema = z.string().min(8, "密码至少需要 8 个字符。").max(128, "密码不能超过 128 个字符。");

export const RegisterInputSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1, "显示名称不能为空。").max(100, "显示名称不能超过 100 个字符。").optional(),
  bootstrapToken: z.string().min(1).max(1_024).optional(),
}).strict();

export const LoginInputSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
}).strict();

export type RegisterInput = z.infer<typeof RegisterInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
