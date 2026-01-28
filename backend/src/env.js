import { z } from "zod";
import "dotenv/config";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),

  DATABASE_URL: z.string().default("file:./dev.db"),

  // Public Pi Platform API base (same for Railway / local)
  PI_API_BASE: z.string().default("https://api.minepi.com/v2"),
  // Railway'de env olarak ayarlanacak
  PI_SERVER_API_KEY: z.string().min(10),

  // Prod ortamda tek origin kullanmanız önerilir (örn: https://slotpi.netlify.app)
  // Geliştirme için '*' bırakılabilir.
  CORS_ORIGIN: z.string().default("*"),

  CREDITS_PER_PI: z.coerce.number().int().positive().default(100),
});

export const env = EnvSchema.parse(process.env);


