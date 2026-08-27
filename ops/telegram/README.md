# Telegram: кнопка «История клиента»

Этот контур напрямую вызывает Telegram Bot API с российского сервера: Google
Apps Script не используется. Первичное сообщение и callback-кнопки по умолчанию
выключены и не зависят от legacy relay.

## Что добавлено

- `POST /api/telegram/webhook/` — единственный HTTP-маршрут.
- `api/telegram/cli/telegram.php` — закрытая CLI для health, просмотра текущего webhook и
  одноразовой регистрации webhook.
- Новая заявка после локальной SQLite-транзакции создаёт единственную запись в
  существующем outbox с режимом `telegram`; cron `leads.php retry` использует прежние
  lease/backoff/claim правила.
- `sendMessage` сохраняет старый вид заявки: заголовок, поля формы и пустые необязательные
  поля; URL страницы не показывается. Внизу находятся WhatsApp и «История клиента».
- Callback `ch1:<lead UUID>` заменяет текст того же сообщения историей.
- Callback `cl1:<lead UUID>` возвращает в то же сообщение заявку и кнопки WhatsApp/истории.
- Поиск истории вызывает тот же `CustomerHistory::forLead(...)`, что и серверная
  `customer-history <UUID>` CLI. Копия контактов/идентификаторов не создаётся.

## Защита

Обработчик одновременно проверяет:

1. Секрет `X-Telegram-Bot-Api-Secret-Token`.
2. Точный ID разрешённой группы/супергруппы.
3. Точный ID сотрудника из белого списка.
4. Что callback пришёл на сообщение, отправленное тем же ботом.
5. Что `callback_data` действительно есть в inline-клавиатуре сообщения.
6. Формат callback и UUID.

Токен, webhook-секрет, ID группы и ID сотрудников хранятся только в
`<deploy_root>/shared/telegram/config.php` (0600) в каталоге 0700. В Git, HTML, JavaScript,
GitHub Secrets этого релиза и callback-данные они не попадают.

## Что нужно от владельца

1. Токен Telegram-бота — вводится прямо в закрытый файл сервера.
2. Числовой ID группы заявок.
3. Числовые Telegram user ID сотрудников, которым можно открывать историю.

Исходник и URL Apps Script не требуются. Legacy relay должен оставаться выключенным:
runtime отклоняет одновременное включение relay и прямой Telegram-доставки.

SQLite не создаёт второй outbox для повторной отправки того же `leadId`, а атомарный
claim не позволяет двум retry-процессам одновременно отправить одну строку. Telegram
Bot API не предоставляет idempotency key для `sendMessage`: если Telegram принял
сообщение, но соединение оборвалось до подтверждения, автоматический retry теоретически
может повторить его. Такие неоднозначные сетевые сбои нужно сверять с группой/outbox;
в штатных подтверждённых ответах, повторных формах и параллельных retry дублей нет.

## Порядок активации после релиза

1. Создать `shared/telegram` (0700), скопировать `config.example.php` в
   `shared/telegram/config.php` (0600), заполнить секреты/списки, установить
   `enabled=true`, но пока оставить `send_leads=false`. Бот должен быть добавлен в
   целевую группу и иметь право отправлять сообщения.
2. Создать 32+ случайных символа для `webhook_secret`.
3. Убедиться, что legacy relay в `shared/leads/config.php` выключен.
4. Создать только приватный marker `state/telegram-history-approved` режима 0600 с
   точными байтами `egoe-life.ru`. Выполнить `telegram.php health`, проверить
   `webhook-info` и затем `register-webhook`. Команда не заменит чужой URL без явного
   `--replace`.
5. После успешной регистрации атомарно установить `send_leads=true`, проверить
   `leads.php health` и только затем создать второй mode-0600 marker
   `state/telegram-delivery-approved` с точными байтами `egoe-life.ru`.
6. Повторить оба health-check, настроить существующий cron `leads.php retry 20`,
   сделать контролируемую тестовую заявку и проверить первичное сообщение,
   «История клиента» → «Назад к заявке». Delivery-marker создаётся последним, поэтому
   до готового webhook сервер не отправляет сообщения с неработающей callback-кнопкой.

Официальный Telegram Bot API требует HTTPS webhook, допускает
`secret_token`, ограничивает `callback_data` 64 байтами поддерживает
`editMessageText` с inline-клавиатурой: <https://core.telegram.org/bots/api>.
