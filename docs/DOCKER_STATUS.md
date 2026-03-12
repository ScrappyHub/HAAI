# Docker status

HAAI has a dedicated compose file and dedicated bind/port policy:

- bind: 127.0.0.1
- port: 54170
- project: haai
- network: haai_net

Current limitation:

docker-compose.haai.yml is policy surface only until the repo has a real Dockerfile or buildable runtime image.

If docker compose fails with a missing Dockerfile or missing image, that is expected until the runtime surface is implemented.
