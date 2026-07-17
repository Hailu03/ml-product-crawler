#!/bin/bash

# Di chuyển vào thư mục dự án
cd /home/git/matthews/ml-product-crawler

# DB server phải là hostname (không dùng IP trực tiếp vì TLS không cho phép),
# cần dòng "207.148.80.25 warehouse-db" trong /etc/hosts
export DB_SERVER=warehouse-db

# 1. Chạy cào dữ liệu song song cho 3 trang và đợi hoàn thành
# (crawler.ts tự parse + lưu vào MSSQL sau khi crawl xong từng site)
/root/.bun/bin/bun run crawler.ts bws.com.au >> /var/log/crawler.log 2>&1 &
/root/.bun/bin/bun run crawler.ts danmurphys.com.au >> /var/log/crawler.log 2>&1 &
/root/.bun/bin/bun run crawler.ts liquorland.com.au >> /var/log/crawler.log 2>&1 &
wait

# 2. Lấy ngày hiện tại theo múi giờ hệ thống (UTC)
TARGET_DATE=$(date +%Y-%m-%d)

# 3. Kiểm tra thư mục dữ liệu và tiến hành nén, gửi mail
if [ -d "data/${TARGET_DATE}" ]; then
    echo "Đang nén dữ liệu ngày ${TARGET_DATE}..." >> /var/log/crawler.log
    zip -r "data_${TARGET_DATE}.zip" "data/${TARGET_DATE}" >> /var/log/crawler.log 2>&1
    
    echo "Đang gửi email báo cáo..." >> /var/log/crawler.log
    echo "Báo cáo dữ liệu sản phẩm cào được ngày ${TARGET_DATE}" | mutt -s "ML Product Crawler [${TARGET_DATE}]" -a "data_${TARGET_DATE}.zip" -- nhutn@epoints.vn hailt@epoints.vn >> /var/log/crawler.log 2>&1
    
    # Xóa file zip sau khi gửi xong
    rm -f "data_${TARGET_DATE}.zip"
else
    echo "LỖI: Không tìm thấy thư mục data/${TARGET_DATE} để gửi mail!" >> /var/log/crawler.log
    echo "Không tìm thấy thư mục dữ liệu ngày ${TARGET_DATE} trên server cào." | mutt -s "ML Product Crawler LỖI [${TARGET_DATE}]" -- nhutn@epoints.vn hailt@epoints.vn >> /var/log/crawler.log 2>&1
fi
