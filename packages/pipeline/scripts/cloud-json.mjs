// Reads the identifiers (not secrets) the web build needs from ~/.vhub-trend/cloud.json, or $VHUB_TREND_HOME.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readCloudJson() {
  const file = join(process.env.VHUB_TREND_HOME || join(homedir(), ".vhub-trend"), "cloud.json");
  let c;
  try {
    c = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Chưa có ${file}. Làm bước kết nối cloud trước (npm run cloud:connect, xem infra/README.md).`);
  }
  if (!c.projectId || !c.apiKey || !c.uid) throw new Error(`${file} thiếu projectId, apiKey hoặc uid. Chạy lại: npm run cloud:connect`);
  if (!c.webClientId) throw new Error(`${file} chưa có webClientId (Client ID đăng nhập Google). Làm bước 7 trong infra/README.md (đặt web_client_id trong terraform.tfvars, terraform apply), rồi chạy lại: npm run cloud:connect`);
  return c;
}
