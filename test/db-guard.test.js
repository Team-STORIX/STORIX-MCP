import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSql, checkPlan, MAX_ROWS } from "../src/modules/db/guard.js";

test("SELECT 는 통과하고 LIMIT 이 없으면 붙인다", () => {
  assert.equal(checkSql("SELECT * FROM works WHERE works_id = 1").sql, `SELECT * FROM works WHERE works_id = 1\nLIMIT ${MAX_ROWS}`);
  assert.equal(checkSql("select works_id from works limit 10;").sql, "select works_id from works limit 10");
  assert.ok(checkSql("WITH t AS (SELECT 1) SELECT * FROM t").sql);
});

test("쓰기 · 여러 문장 · 락 · 위험 함수는 거부", () => {
  for (const sql of [
    "UPDATE works SET works_name = 'x'",
    "DELETE FROM works",
    "SELECT 1; DROP TABLE works",
    "SELECT * FROM works FOR UPDATE",
    "SELECT * FROM works FOR SHARE",
    "SELECT * FROM works LOCK IN SHARE MODE",
    "SELECT * FROM works INTO OUTFILE '/tmp/x'",
    "SELECT SLEEP(10)",
    "SELECT GET_LOCK('a', 10)",
    "SELECT * FROM mysql.user",
    "WITH t AS (SELECT 1) DELETE FROM works",
    "",
  ]) {
    assert.ok(checkSql(sql).error, sql);
  }
});

test("문자열 · 주석 안의 단어는 문제 삼지 않는다", () => {
  assert.ok(checkSql("SELECT * FROM works WHERE works_name = 'for update 가 들어간 제목; drop'").sql);
  assert.ok(checkSql("SELECT works_id /* update */ FROM works -- delete\n WHERE works_id = 1").sql);
});

test("LIMIT 상한", () => {
  assert.ok(checkSql(`SELECT * FROM works LIMIT ${MAX_ROWS + 1}`).error);
  assert.ok(checkSql("SELECT * FROM works LIMIT 10, 20").sql);
});

test("인덱스를 안 타는 큰 테이블 조회는 거부, 작은 테이블은 허용", () => {
  assert.match(checkPlan([{ table: "works", type: "ALL", rows: 5800 }]), /works \(전체 스캔/);
  assert.match(checkPlan([{ table: "works_hashtag", type: "index", rows: 60000 }]), /인덱스 전체 스캔/);
  assert.equal(checkPlan([{ table: "hashtag", type: "ALL", rows: 300 }]), null);
  assert.equal(checkPlan([{ table: "works", type: "ref", rows: 1 }, { table: "works_platform", type: "eq_ref", rows: 1 }]), null);
});
