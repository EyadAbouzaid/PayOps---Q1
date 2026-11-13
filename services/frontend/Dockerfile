FROM nginx:1.27-alpine
COPY services/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY services/frontend/public /usr/share/nginx/html
EXPOSE 80
