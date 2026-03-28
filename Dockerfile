FROM node:24-slim

WORKDIR /app

# pnpm 설치 및 활성화
RUN corepack enable && corepack prepare pnpm@latest --activate

# 1. 의존성 파일만 먼저 복사 (레이어 캐시 최적화의 핵심)
COPY package.json pnpm-lock.yaml ./

# 2. 프로덕션 의존성만 설치 (lockfile을 기준으로 정확한 버전 설치)
RUN pnpm install --frozen-lockfile --prod

# 3. 실제 소스 코드 복사
COPY . .

CMD ["node", "index.js"]