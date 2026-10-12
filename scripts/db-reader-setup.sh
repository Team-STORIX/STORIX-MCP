#!/usr/bin/env bash
# db 모듈(운영 DB 읽기 전용 조회)을 쓰기 위한 AWS 설정. 한 번만 실행하면 된다.
# 운영 RDS 설정과 IAM 을 바꾸므로 내용을 읽고 직접 실행한다.
#   1) RDS IAM DB 인증 켜기 (MySQL 은 재부팅 없이 적용)
#   2) storix_reader 로만 접속할 수 있는 IAM 정책을 만들어 developers · admin 그룹에 붙이기
# DB 계정은 scripts/db-reader.sql 을 마스터 계정으로 실행해 만든다.
set -euo pipefail

# 계정 ID 는 저장소에 적지 않는다. 실행하는 사람의 자격증명에서 읽는다 (AWS_ACCOUNT_ID 로 직접 줄 수도 있다)
ACCOUNT=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}
REGION=ap-northeast-2
DB_INSTANCE=storix-deploy
DB_USER=storix_reader
POLICY_NAME=storix-db-reader-connect
# GROUPS 는 bash 예약 변수(현재 사용자의 그룹 ID)라 다른 이름을 쓴다
IAM_GROUPS=(developers admin)

echo "== 1) RDS IAM DB 인증 켜기"
aws rds modify-db-instance --region "$REGION" --db-instance-identifier "$DB_INSTANCE" \
  --enable-iam-database-authentication --apply-immediately \
  --query 'DBInstance.PendingModifiedValues' >/dev/null
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_INSTANCE"

RESOURCE_ID=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE" \
  --query 'DBInstances[0].DbiResourceId' --output text)

echo "== 2) 접속 정책 (이 DB 의 $DB_USER 로만)"
POLICY_ARN=arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}
# 다시 실행해도 되게 정책이 이미 있으면 만들지 않는다
aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1 || aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"rds-db:connect\",
    \"Resource\":\"arn:aws:rds-db:${REGION}:${ACCOUNT}:dbuser:${RESOURCE_ID}/${DB_USER}\"}]
}" >/dev/null
for g in "${IAM_GROUPS[@]}"; do
  aws iam attach-group-policy --group-name "$g" --policy-arn "$POLICY_ARN"
done

echo "== 끝. MCP 설정에 넣을 값"
echo "STORIX_READER_RDS_HOST=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
