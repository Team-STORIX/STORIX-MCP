-- 운영 DB 읽기 전용 계정 (db 모듈). RDS 마스터 계정으로 한 번 실행한다.
-- 비밀번호 없이 IAM 인증 토큰으로만 붙는다 (RDS 에 IAM DB 인증이 켜져 있어야 한다 — scripts/db-reader-setup.sh)
-- 개인정보가 있는 테이블(user 계열 · 채팅 · 신고 · 성인인증 · 푸시 기기 · 알림)에는 권한을 주지 않는다.

CREATE USER IF NOT EXISTS 'DB_USER'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS'
  REQUIRE SSL WITH MAX_USER_CONNECTIONS 3;

-- 서비스 DB: 작품과 앱에 공개로 보이는 데이터만
GRANT SELECT ON PROD_DB.works            TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.works_platform   TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.works_hashtag    TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.works_nickname   TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.hashtag          TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.review           TO 'DB_USER'@'%';
GRANT SELECT ON PROD_DB.topic_room       TO 'DB_USER'@'%';

-- 크롤러 검수 DB (수집 이력 · 검수 상태)
GRANT SELECT ON STAGING_DB.* TO 'DB_USER'@'%';

SHOW GRANTS FOR 'DB_USER'@'%';
