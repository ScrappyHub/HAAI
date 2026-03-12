FROM alpine:3.20

WORKDIR /srv/www

COPY runtime/site/ /srv/www/

EXPOSE 54170

CMD ["sh","-lc","exec busybox httpd -f -p 54170 -h /srv/www"]
