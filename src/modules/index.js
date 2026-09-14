import * as swagger from "./swagger/index.js";
import * as auth from "./auth/index.js";
import * as report from "./report/index.js";
import * as metrics from "./metrics/index.js";
import * as mobile from "./mobile/index.js";
import * as flow from "./flow/index.js";

// 모듈을 추가하려면 여기 한 줄만 넣으면 된다.
export const modules = [swagger, auth, report, metrics, mobile, flow];
