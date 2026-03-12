FROM nginx:1.27-alpine

COPY runtime/site/ /usr/share/nginx/html/
COPY runtime/nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 54170
