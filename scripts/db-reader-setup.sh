#!/usr/bin/env bash
# db 모듈(운영 DB 읽기 전용 조회)을 쓰기 위한 AWS 설정. 한 번만 실행하면 된다 (다시 실행해도 된다).
# 운영 RDS 설정과 IAM 을 바꾸므로 내용을 읽고 직접 실행한다.
#   1) RDS IAM DB 인증 켜기 (MySQL 은 재부팅 없이 적용)
#   2) 접속 정보를 Parameter Store(<prefix>/db/*)에 넣기 — MCP 가 각자의 자격증명으로 읽는다
#   3) 그 값 읽기 + 읽기 전용 계정 접속만 허용하는 IAM 정책을 developers · admin 그룹에 붙이기
#   4) 읽기 전용 DB 계정을 만드는 SQL 출력 — RDS 마스터 계정으로 실행한다
#
# 공개 저장소라 RDS · 계정 · 스키마 이름은 여기 적지 않고 실행할 때 받는다.
#   DB_INSTANCE=<RDS 인스턴스> DB_USER=<읽기 전용 계정> PROD_DB=<서비스 스키마> STAGING_DB=<검수 스키마> \
#     bash scripts/db-reader-setup.sh
set -euo pipefail

: "${DB_INSTANCE:?RDS 인스턴스 식별자를 DB_INSTANCE 로 주세요}"
: "${DB_USER:?읽기 전용 DB 계정 이름을 DB_USER 로 주세요}"
: "${PROD_DB:?서비스 DB 스키마를 PROD_DB 로 주세요}"
: "${STAGING_DB:?크롤러 검수 DB 스키마를 STAGING_DB 로 주세요}"

# 계정 ID 는 저장소에 적지 않는다. 실행하는 사람의 자격증명에서 읽는다 (AWS_ACCOUNT_ID 로 직접 줄 수도 있다)
ACCOUNT=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}
REGION=ap-northeast-2
PARAM_PREFIX=${STORIX_PARAM_PREFIX:-/storix/dev}
POLICY_NAME=storix-db-reader-connect
# GROUPS 는 bash 예약 변수(현재 사용자의 그룹 ID)라 다른 이름을 쓴다
IAM_GROUPS=(developers admin)
# 개인정보가 있는 테이블(user 계열 · 채팅 · 신고 · 성인인증 · 푸시 기기 · 알림)은 넣지 않는다
PROD_TABLES=(works works_platform works_hashtag works_nickname hashtag review topic_room)

echo "== 1) RDS IAM DB 인증 켜기"
aws rds modify-db-instance --region "$REGION" --db-instance-identifier "$DB_INSTANCE" \
  --enable-iam-database-authentication --apply-immediately \
  --query 'DBInstance.PendingModifiedValues' >/dev/null
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_INSTANCE"

read -r RESOURCE_ID RDS_HOST < <(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE" \
  --query 'DBInstances[0].[DbiResourceId,Endpoint.Address]' --output text)

echo "== 2) 접속 정보 → Parameter Store ($PARAM_PREFIX/db/*)"
put() { aws ssm put-parameter --region "$REGION" --name "$PARAM_PREFIX/db/$1" --value "$2" --type String --overwrite >/dev/null; }
put rds-host "$RDS_HOST"
put user "$DB_USER"
put prod-db "$PROD_DB"
put staging-db "$STAGING_DB"

echo "== 3) 정책 $POLICY_NAME (접속 정보 읽기 + $DB_USER 로만 접속)"
POLICY_ARN=arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}
POLICY_DOC="{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":\"rds-db:connect\",
     \"Resource\":\"arn:aws:rds-db:${REGION}:${ACCOUNT}:dbuser:${RESOURCE_ID}/${DB_USER}\"},
    {\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameters\",
     \"Resource\":\"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${PARAM_PREFIX}/db/*\"}
  ]
}"
if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  # 정책 버전은 5개까지라 기본이 아닌 가장 오래된 버전을 지우고 새 버전을 기본으로 만든다
  OLD=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
    --query 'sort_by(Versions[?IsDefaultVersion==`false`],&CreateDate)[0].VersionId' --output text)
  COUNT=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'length(Versions)' --output text)
  [ "$COUNT" -ge 5 ] && aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$OLD"
  aws iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document "$POLICY_DOC" --set-as-default >/dev/null
else
  aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "$POLICY_DOC" >/dev/null
fi
for g in "${IAM_GROUPS[@]}"; do
  aws iam attach-group-policy --group-name "$g" --policy-arn "$POLICY_ARN"
done

echo "== 4) 아래 SQL 을 RDS 마스터 계정으로 실행 (DataGrip 등)"
echo
cat <<SQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS'
  REQUIRE SSL WITH MAX_USER_CONNECTIONS 3;
$(for t in "${PROD_TABLES[@]}"; do echo "GRANT SELECT ON ${PROD_DB}.${t} TO '${DB_USER}'@'%';"; done)
GRANT SELECT ON ${STAGING_DB}.* TO '${DB_USER}'@'%';
SHOW GRANTS FOR '${DB_USER}'@'%';
SQL
