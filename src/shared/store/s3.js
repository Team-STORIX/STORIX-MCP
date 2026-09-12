// Lambda 에서 쓴다. SDK 는 nodejs 런타임에 들어 있어 의존성으로 넣지 않는다.
// 이 백엔드를 고를 때만 불러오므로 로컬에는 SDK 가 없어도 된다.
const BUCKET = process.env.SWAGGER_SNAPSHOT_S3_BUCKET || "";
const PREFIX = (process.env.SWAGGER_SNAPSHOT_S3_PREFIX || "swagger-snapshots").replace(/^\/|\/$/g, "");
const REGION = process.env.AWS_REGION || "ap-northeast-2";

export const location = `s3://${BUCKET}/${PREFIX}`;

const keyOf = (key) => `${PREFIX}/${key}`;

let clientPromise = null;

async function client() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let mod;
    try {
      mod = await import("@aws-sdk/client-s3");
    } catch {
      throw new Error(
        "@aws-sdk/client-s3 를 불러오지 못했습니다. Lambda 런타임 밖에서 S3 백엔드를 쓰려면 따로 설치해야 합니다."
      );
    }
    return { mod, s3: new mod.S3Client({ region: REGION }) };
  })();
  return clientPromise;
}

export async function read(key) {
  const { mod, s3 } = await client();
  try {
    const res = await s3.send(new mod.GetObjectCommand({ Bucket: BUCKET, Key: keyOf(key) }));
    return await res.Body.transformToString();
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export async function write(key, body) {
  const { mod, s3 } = await client();
  await s3.send(
    new mod.PutObjectCommand({ Bucket: BUCKET, Key: keyOf(key), Body: body, ContentType: "application/json" })
  );
  return `s3://${BUCKET}/${keyOf(key)}`;
}

export async function list() {
  const { mod, s3 } = await client();
  const out = [];
  let token;
  do {
    const res = await s3.send(
      new mod.ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/`, ContinuationToken: token })
    );
    for (const o of res.Contents || []) {
      const key = o.Key.slice(PREFIX.length + 1);
      if (!key.endsWith(".json") || key.includes("/")) continue;
      out.push({ key, modifiedAt: new Date(o.LastModified).toISOString() });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}
