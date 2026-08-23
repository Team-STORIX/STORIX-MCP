export const text = (s) => ({ content: [{ type: "text", text: s }] });
export const fail = (s) => ({ content: [{ type: "text", text: s }], isError: true });

// 툴 이름은 모듈 이름을 앞에 붙인다. 한 서버에 여러 모듈이 올라가도 안 겹치고,
// 이름만 보고 어느 모듈 툴인지 알 수 있다.
export function namespaced(server, namespace) {
  return (name, meta, handler) => server.registerTool(`${namespace}_${name}`, meta, handler);
}
