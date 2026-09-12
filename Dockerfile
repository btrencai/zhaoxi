# 朝夕 云同步服务端（单文件 Python + SQLite）
# 构建： docker build -t zhaoxi-cloud .
# 运行： docker run -d -p 8787:8787 -v zhaoxi-data:/data zhaoxi-cloud
FROM python:3.12-slim

WORKDIR /app
COPY tools/cloud-server.py /app/cloud-server.py

ENV PYTHONUNBUFFERED=1
EXPOSE 8787
VOLUME ["/data"]

# 数据（SQLite）与配置（cloud-config.json，可选）都放在 /data 卷里
CMD ["python", "/app/cloud-server.py", "--host", "0.0.0.0", "--port", "8787", "--db", "/data/zhaoxi-cloud.db", "--config", "/data/cloud-config.json"]
