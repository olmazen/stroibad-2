# Релизный процесс

## Среды

| Среда | Назначение | Источник |
|---|---|---|
| PR artifact | Проверка точного состава сборки | `dist` из commit PR |
| GitHub Pages | Staging после merge | `dist` из `main` |
| REG.RU | Production | тот же проверенный artifact после подтверждения |

GitHub Pages и `www.egoe-life.ru` — разные среды. Успех Pages не означает, что production обновился.

GitHub Pages — публичный иностранный preview без контроля доступа. Его URL не рекламируют и не используют для реальных заявок; формы там заблокированы host-gate, а `robots.txt` запрещает индексацию пути `/stroibad-2/`. Проверка выполняется только на синтетических данных. Реальная запись формы, SQLite и удаление тестового лида проверяются на REG.RU после атомарного production-переключения.

## Нормальный релиз

1. PR проходит `Site quality`.
2. Workflow GitHub Pages сохраняет тот же `dist` как `egoe-release-<SHA>` и без пересборки публикует его на staging.
3. Изменение проверяется на preview/staging.
4. Пользователь отдельно подтверждает production-релиз.
5. `deploy-production.yml` по ID успешного Pages-run скачивает уже проверенный artifact, не пересобирая его.
6. До переключения сервер проверяет manifest, PHP-синтаксис, SQLite/config/shared-leads и backend self-test; после переключения проверяются главная, каталог, карточка, корзина, endpoint и ключевые ассеты.
7. В release note фиксируются SHA, время, результат smoke и предыдущий рабочий SHA.

Production-доступ выполняется отдельным ключом GitHub Actions, закреплённым host key, ограниченным deploy-root и защищённым GitHub Environment. Сервер хранит неизменяемые каталоги `releases/<SHA>`, постоянный `shared/` вне web-root и атомарный symlink `current`; предыдущая цель сохраняется для rollback. Старый Webnames workflow заархивирован: он указывал на другой хостинг и публиковал корень репозитория.

`prepare-release.yml` может использоваться для архива, но production не берёт его пересобранный artifact: источником production служит только artifact фактически просмотренного GitHub Pages run.

## Rollback

Rollback — атомарное возвращение symlink `current` на предыдущий проверенный неизменяемый release. Нельзя откатывать рабочее дерево destructive-командами или вручную собирать ZIP из произвольного состояния.

Минимальные данные для релиза:

- commit SHA;
- SHA предыдущего production;
- имя/хеш artifact;
- кто подтвердил публикацию;
- результаты post-deploy smoke;
- известные исключения.

## Branch protection

Защита `main` включается после появления первого зелёного `Site quality` check. Требуемая целевая конфигурация:

- изменения только через PR;
- обязательный зелёный `Site quality`;
- запрет force-push и удаления ветки;
- production environment с ручным approval;
- один production deploy одновременно.

Настройки репозитория не изменяются неявно из локальной задачи: это отдельная подтверждённая операция.
