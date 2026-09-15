import axios from "axios";
import { env } from "../config/env.js";

export async function checkAiHealth() {
  const response = await axios.get(`${env.aiServiceUrl}/health`, { timeout: 3_000 });
  return response.data;
}
