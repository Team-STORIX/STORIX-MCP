#!/usr/bin/env bash
# auth 모듈이 .storix-mcp.json 없이 Parameter Store 에서 계정을 읽게 하는 IAM 설정. 한 번만 실행하면 된다 (다시 실행해도 된다).
# IAM 을 바꾸므로 내용을 읽고 직접 실행한다.
#   - tester: 팀이 같이 쓰는 계정 하나 → <prefix>/auth/tester/pending-id (그룹 전원이 읽기)
#   - admin : 각자 가입한 계정       → <prefix>/auth/admin/<IAM 사용자 이름>/{email,password}
#             정책이 ${aws:username} 으로 묶어 자기 경로만 읽고 쓴다. 남의 admin 계정은 못 본다
# 값은 이 스크립트가 넣지 않는다. 끝에 나오는 명령으로 각자 넣는다 (비밀번호가 셸 기록에 남지 않게 read -s 로 받는다).
set -euo pipefail

# 계정 ID 는 저장소에 적지 않는다. 실행하는 사람의 자격증명에서 읽는다 (AWS_ACCOUNT_ID 로 직접 줄 수도 있다)
ACCOUNT=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}
REGION=ap-northeast-2
PARAM_PREFIX=${STORIX_PARAM_PREFIX:-/storix/dev}
POLICY_NAME=storix-mcp-auth-params
# GROUPS 는 bash 예약 변수(현재 사용자의 그룹 ID)라 다른 이름을 쓴다
IAM_GROUPS=(developers admin)

PARAM_ARN=arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${PARAM_PREFIX}
# SecureString 은 기본 키(aws/ssm)로 암호화한다. 이 키는 SSM 을 거친 계정 내 호출을 허용하므로 KMS 권한은 따로 주지 않는다
POLICY_DOC="{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameters\",
     \"Resource\":\"${PARAM_ARN}/auth/tester/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameters\",\"ssm:PutParameter\"],
     \"Resource\":\"${PARAM_ARN}/auth/admin/\${aws:username}/*\"}
  ]
}"

echo "== 정책 $POLICY_NAME (tester 읽기 + 자기 admin 경로 읽기 · 쓰기)"
POLICY_ARN=arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}
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

cat <<EOF

== 값 넣기
tester (관리자가 한 번. 슬랙 승인까지 받은 pendingId):
  read -rs PID && aws ssm put-parameter --region $REGION --type SecureString --overwrite \\
    --name $PARAM_PREFIX/auth/tester/pending-id --value "\$PID"; unset PID

admin (각자 자기 AWS 프로필로. 경로의 이름은 자기 IAM 사용자 이름이어야 정책이 허용한다):
  ME=\$(aws sts get-caller-identity --query Arn --output text | sed 's|.*/||')
  read -r EMAIL && read -rs PW && \\
  aws ssm put-parameter --region $REGION --type SecureString --overwrite --name $PARAM_PREFIX/auth/admin/\$ME/email --value "\$EMAIL" && \\
  aws ssm put-parameter --region $REGION --type SecureString --overwrite --name $PARAM_PREFIX/auth/admin/\$ME/password --value "\$PW"; unset EMAIL PW
EOF
