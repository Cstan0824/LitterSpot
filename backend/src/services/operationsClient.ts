import axios from "axios";
import { env } from "../config/env.js";

const headers = () => env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {};

export const operationsClient = {
  async dashboard() {
    return (await axios.get(`${env.aiServiceUrl}/operations/dashboard`, { headers: headers(), timeout: 5_000 })).data;
  },
  async alerts(params: Record<string, string | undefined>) {
    return (await axios.get(`${env.aiServiceUrl}/operations/alerts`, { headers: headers(), params, timeout: 5_000 })).data;
  },
  async history(params: Record<string, string | undefined>) {
    return (await axios.get(`${env.aiServiceUrl}/operations/history`, { headers: headers(), params, timeout: 5_000 })).data;
  },
  async placement() {
    return (await axios.get(`${env.aiServiceUrl}/operations/placement`, { headers: headers(), timeout: 10_000 })).data;
  },
  async updateAlertStatus(alertId: string, status: string, operatorName?: string, note?: string) {
    return (await axios.patch(`${env.aiServiceUrl}/operations/alerts/${encodeURIComponent(alertId)}/status`, {
      status, operatorName, note,
    }, { headers: headers(), timeout: 5_000 })).data;
  },
  async evidence(analysisId: string) {
    return axios.get(`${env.aiServiceUrl}/analysis/evidence/${encodeURIComponent(analysisId)}`, {
      headers: headers(), responseType: "stream", timeout: 10_000,
    });
  },
};
