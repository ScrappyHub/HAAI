FROM alpine:3.20

WORKDIR /srv/www
COPY runtime/site/ /srv/www/

EXPOSE 54170

CMD ["/bin/busybox","httpd","-f","-v","-p","54170","-h","/srv/www"]
