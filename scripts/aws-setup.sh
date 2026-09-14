#!/usr/bin/env bash
# 스펙 변경 알림 Lambda 를 만드는 명령 모음. 한 번만 실행하면 된다.
# 계정에 리소스를 만드므로 내용을 읽고 직접 실행한다.
set -euo pipefail

ACCOUNT=697629627444
REGION=ap-northeast-2
FUNCTION=storix-spec-changelog
BUCKET=${BUCKET:?스냅샷을 둘 S3 버킷 이름을 BUCKET 으로 넘겨라}
PREFIX=swagger-snapshots
DEPLOY_ROLE=arn:aws:iam::${ACCOUNT}:role/StorixAppDeploy
ROLE_NAME=StorixSpecChangelogLambda

echo "== 실행 역할 만들기"
aws iam create-role --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null

aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# 스냅샷 프리픽스 밖으로는 손대지 못하게 한다
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name snapshots-only \
  --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[
      {\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\"],
       \"Resource\":\"arn:aws:s3:::${BUCKET}/${PREFIX}/*\"},
      {\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameters\",
       \"Resource\":\"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/storix/dev/swagger/*\"},
      {\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",
       \"Resource\":\"arn:aws:s3:::${BUCKET}\",
       \"Condition\":{\"StringLike\":{\"s3:prefix\":\"${PREFIX}/*\"}}}
    ]
  }"

echo "== 함수 만들기 (zip 은 워크플로 아티팩트에서 받아둔다)"
aws lambda create-function --function-name "$FUNCTION" --region "$REGION" \
  --runtime nodejs24.x --handler src/lambda.handler \
  --role "arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}" \
  --timeout 60 --memory-size 512 \
  --zip-file fileb://lambda.zip \
  --environment "Variables={
    SWAGGER_SNAPSHOT_S3_BUCKET=${BUCKET},
    SWAGGER_SNAPSHOT_S3_PREFIX=${PREFIX},
    STORIX_SLACK_WEBHOOK_URL=$STORIX_SLACK_WEBHOOK_URL
  }"

# 배포 역할 외에는 계정 안에서도 못 부르게 한다
echo "== 호출 권한을 배포 역할로만 좁히기"
aws lambda add-permission --function-name "$FUNCTION" --region "$REGION" \
  --statement-id only-deploy-role --action lambda:InvokeFunction \
  --principal "$DEPLOY_ROLE"

echo
echo "끝. Function URL 은 만들지 않는다 - 만들면 공개 엔드포인트가 생긴다."
echo "배포 역할에 아래 권한을 더해야 CD 에서 부를 수 있다:"
echo "  lambda:InvokeFunction on arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FUNCTION}"
