#!/bin/sh
set -eu
umask 077
mkdir -p .secrets data
if [ ! -f .env ]; then
  cp .env.example .env
fi
if [ ! -f .secrets/app-key ]; then
  openssl rand -hex 32 > .secrets/app-key
fi
printf '%s\n' '目录和助手密钥已准备。请在 .env 填写 Cloud Mail 地址及邮箱，并将邮箱密码保存到 .secrets/mailbox-password。'
