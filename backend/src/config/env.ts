import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000",
  aiServiceToken: process.env.AI_SERVICE_TOKEN,
};
