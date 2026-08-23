import * as swagger from "./swagger/index.js";
import * as auth from "./auth/index.js";
import * as report from "./report/index.js";

// 모듈을 추가하려면 여기 한 줄만 넣으면 된다.
export const modules = [swagger, auth, report];
