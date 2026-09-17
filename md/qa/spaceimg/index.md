---
title: 含空格图片名测试
company: T
date: 2026年9月
---

# 含空格图片名测试

## 普通名（对照组）

![图A](assets/diagram.png)

## 含空格名-裸写（CommonMark 非法）

![图B](assets/我的 图片.png)

## 含空格名-尖括号（CommonMark 合法）

![图C](<assets/我的 图片.png>)

## 含空格名-百分号转义（合法）

![图D](assets/%E6%88%91%E7%9A%84%20%E5%9B%BE%E7%89%87.png)
