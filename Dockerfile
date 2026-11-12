FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY agent/package.json agent/package-lock.json ./agent/
RUN cd agent && npm ci --omit=dev && npm cache clean --force
COPY agent/*.mjs ./agent/
COPY src/visitor-model.ts src/renewal.ts src/auth.ts ./src/
COPY web/ ./web/
COPY calendar/ ./calendar/
USER pwuser
WORKDIR /app/agent
CMD ["node", "main.mjs"]
