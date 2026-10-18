"""main 에 Release 커밋이 들어오면 태그 · GitHub Release 를 만든다 (#80). publish.yml 이 부른다.

squash 머지라 커밋 제목이 'Release vX.Y.Z (#N)' 이다. Release PR 본문의 'PR #N의 커밋 cherry-pick (제목)' 줄로 노트를 쓴다.
만들었으면 GITHUB_OUTPUT 에 version 을 남겨 같은 워크플로의 npm 배포가 이어서 돈다.
크롤러 레포의 tools/release_notes.py 와 같은 규칙이다.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

RELEASE_COMMIT = re.compile(r'^Release (v\d+\.\d+\.\d+) \(#(\d+)\)')
CHERRY_PICK = re.compile(r'PR #(\d+)의 커밋 cherry-pick \((.+)\)')
TYPE_PREFIX = re.compile(r'^(?:Feat|Fix|Refactor|Chore|Docs|Test): (?:\[[^\]]+\] )?')


def parse_commit(message: str) -> tuple[str, int] | None:
    m = RELEASE_COMMIT.match((message or '').splitlines()[0] if message else '')
    return (m.group(1), int(m.group(2))) if m else None


def included_prs(body: str) -> list[tuple[str, str]]:
    return [(n, TYPE_PREFIX.sub('', title.strip())) for n, title in CHERRY_PICK.findall(body or '')]


def notes(version: str, release_pr: int, prs: list[tuple[str, str]]) -> str:
    lines = '\n'.join(f'- {title} (#{n})' for n, title in prs) or '- (Release PR 본문에서 PR 목록을 찾지 못함)'
    included = ', '.join(f'#{n}' for n, _ in prs) or '-'
    return f'## STORIX MCP {version} 릴리즈\n\n{lines}\n\n포함 PR: {included}\nRelease PR: #{release_pr}\n'


def gh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['gh', *args], capture_output=True, text=True)


def main(message: str, sha: str) -> int:
    parsed = parse_commit(message)
    if not parsed:
        print('Release 커밋이 아님 — 건너뜀')
        return 0
    version, pr = parsed
    with open('package.json', encoding='utf-8') as f:
        pkg_version = json.load(f)['version']
    if f'v{pkg_version}' != version:
        print(f'package.json 버전({pkg_version})과 Release 제목({version})이 다름', file=sys.stderr)
        return 1
    repo = os.environ['GITHUB_REPOSITORY']
    if gh('api', f'repos/{repo}/git/ref/tags/{version}').returncode == 0:
        print(f'{version} 태그가 이미 있음 — 건너뜀 (npm 배포를 다시 하려면 publish.yml 을 수동 실행)')
        return 0
    view = gh('pr', 'view', str(pr), '-R', repo, '--json', 'body')
    body = json.loads(view.stdout).get('body', '') if view.returncode == 0 else ''
    text = notes(version, pr, included_prs(body))
    created = subprocess.run(['gh', 'release', 'create', version, '-R', repo, '--target', sha, '--title', version,
                              '--notes-file', '-'], input=text, capture_output=True, text=True)
    if created.returncode:
        print(created.stderr, file=sys.stderr)
        return 1
    print(f'{version} 릴리스를 만들었습니다\n{text}')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(f'version={version}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
