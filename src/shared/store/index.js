// 스냅샷 바이트를 어디에 두는지만 가른다. 라벨 규칙과 색인 병합은 snapshots.js 가 그대로 한다.
import * as fsStore from "./fs.js";

const useS3 = Boolean(process.env.SWAGGER_SNAPSHOT_S3_BUCKET);

let cached = null;

export async function store() {
  if (cached) return cached;
  cached = useS3 ? await import("./s3.js") : fsStore;
  return cached;
}

export const backendName = useS3 ? "s3" : "fs";
