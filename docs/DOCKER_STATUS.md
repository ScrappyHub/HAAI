# Docker status

HAAI now has a real dedicated Docker runtime surface.

Locked values:

- bind: 127.0.0.1
- port: 54170
- project: haai
- network: haai_net
- container: haai_runtime

Current runtime surface:

- Dockerfile
- .dockerignore
- docker-compose.haai.yml
- runtime/site/healthz
- runtime/site/index.json

Current behavior:

- builds a local image `haai:local`
- serves a minimal runtime endpoint on the dedicated HAAI port
- does not share the compose project, container, or network with unrelated projects

Live checks:

- GET /healthz -> ok
- GET /index.json -> runtime metadata
