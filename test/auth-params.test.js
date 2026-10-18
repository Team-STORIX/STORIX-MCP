import { test } from "node:test";
import assert from "node:assert/strict";
import { userNameFromArn, adminParams, testerParams } from "../src/modules/auth/params.js";

test("IAM 사용자 ARN 에서 이름만 뽑는다", () => {
  assert.equal(userNameFromArn("arn:aws:iam::123456789012:user/alice"), "alice");
  assert.equal(userNameFromArn("arn:aws:iam::123456789012:user/team/dev/bob"), "bob");
});

test("IAM 사용자가 아니면 null", () => {
  assert.equal(userNameFromArn("arn:aws:sts::123456789012:assumed-role/Admin/session"), null);
  assert.equal(userNameFromArn("arn:aws:iam::123456789012:root"), null);
  assert.equal(userNameFromArn(undefined), null);
});

test("계정은 IAM 사용자 이름 아래 경로", () => {
  assert.deepEqual(adminParams("alice"), {
    email: "auth/admin/alice/email",
    password: "auth/admin/alice/password",
  });
  assert.deepEqual(testerParams("alice"), { pendingId: "auth/tester/alice/pending-id" });
});
