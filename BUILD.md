#### Docker 构建部署推送命令

构建镜像并标记为 1.0.6：

```bash
docker build -t zkeq/self-cinema:2.0.0 .
```

标记为 latest：

```bash
docker tag zkeq/self-cinema:2.0.0 zkeq/self-cinema:latest

docker tag zkeq/self-cinema:2.0.0 docker.cnb.cool/onmicrosoft/self-cinema:2.0.0

docker tag zkeq/self-cinema:2.0.0 docker.cnb.cool/onmicrosoft/self-cinema:latest
```


推送 1.0.6 版本：

```bash
docker push zkeq/self-cinema:2.0.0
docker push docker.cnb.cool/onmicrosoft/self-cinema:2.0.0
```


推送 latest 版本：

```bash
docker push zkeq/self-cinema:latest
docker push docker.cnb.cool/onmicrosoft/self-cinema:latest
```