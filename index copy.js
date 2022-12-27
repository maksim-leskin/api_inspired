// импорт стандартных библиотек Node.js
const { readFileSync } = require("fs");
const { createServer } = require("http");
const path = require("path");

// файл для базы данных
const DB_FILE = process.env.DB_FILE || path.resolve(__dirname, "db.json");
// номер порта, на котором будет запущен сервер
const PORT = process.env.PORT || 8024;
// префикс URI для всех методов приложения
const URI_PREFIX = "/api/goods";

/**
 * Класс ошибки, используется для отправки ответа с определённым кодом и описанием ошибки
 */
class ApiError extends Error {
  constructor(statusCode, data) {
    super();
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * Фильтрует список товаров по дисконту и возвращает случайных 16 товаров
 * @param {[{discountPrice: number}]} [goods] - товары
 * @returns {{ id: string, title: string, price: number, discountPrice: number, description: Object[],
 * category: string, image: string}[]} Массив товаров
 */

const pagination = (goods, page, count, sort) => {
  const sortGoods = !sort.value
    ? goods
    : goods.sort((a, b) => {
        if (sort.value === "price") {
          if (sort.direction === "up") {
            return a.price > b.price ? 1 : -1;
          }
          return a.price > b.price ? -1 : 1;
        }

        if (sort.direction === "up") {
          return a.title.toLowerCase() > b.title.toLowerCase() ? 1 : -1;
        }
        return a.title.toLowerCase() > b.title.toLowerCase() ? -1 : 1;
      });

  let end = count * page;
  let start = page === 1 ? 0 : end - count;

  const pages = Math.ceil(sortGoods.length / count);

  return {
    goods: sortGoods.slice(start, end),
    page,
    pages,
  };
};

/**
 * Возвращает список товаров из базы данных
 * @param {{ search: string, category: string, list: string }} [params] - Поисковая строка
 * @returns {{ id: string, title: string, price: number, discountPrice: number, description: Object[],
 * category: string, image: string}[]} Массив товаров
 */
function getGoodsList(params = {}) {
  const page = +params.page || 1;
  const paginationCount = params.count || 12;
  const sort = {
    value: params.sort,
    direction: params.direction || "up",
  };
  const goods = JSON.parse(readFileSync(DB_FILE) || "[]");

  // фильтрация
  let data = goods;

  if (params.search) {
    const search = params.search.trim().toLowerCase();
    data = goods.filter(
      (item) =>
        item.title.toLowerCase().includes(search) ||
        item.description.some((item) => item.toLowerCase().includes(search))
    );
  }

  if (params.list) {
    const list = params.list.trim().toLowerCase();
    return goods.filter((item) => list.includes(item.id));
  }

  if (params.category) {
    const category = params.category.trim().toLowerCase();
    const regExp = new RegExp(`^${category}$`);
    data = data.filter((item) => regExp.test(item.category.toLowerCase()));
  }

  if (params.color) {
    data = data.filter((item) => params.color?.includes(item.color));
  }

  if (params.minprice) {
    data = data.filter((item) => params.minprice <= item.price);
  }

  if (params.maxprice) {
    data = data.filter((item) => params.maxprice >= item.price);
  }

  if (params.mindisplay) {
    data = data.filter((item) => params.mindisplay <= item.display);
  }

  if (params.maxdisplay) {
    data = data.filter((item) => params.maxdisplay >= item.display);
  }

  return pagination(data, page, paginationCount, sort);
}

/**
 * Возвращает объект товара по его ID
 * @param {string} itemId - ID товара
 * @throws {ApiError} Товар с таким ID не найден (statusCode 404)
 * @returns {{ id: string, title: string, price: number, discountPrice: number, description: Object[],
 * category: string, image: string}} Объект клиента
 */
function getItems(itemId) {
  const goods = JSON.parse(readFileSync(DB_FILE) || "[]");
  const item = goods.find(({ id }) => id === itemId);
  if (!item) throw new ApiError(404, { message: "Item Not Found" });
  return item;
}

function getCategory() {
  const goods = JSON.parse(readFileSync(DB_FILE) || "[]");
  const category = {};
  for (let i = 0; i < goods.length; i++) {
    category[goods[i].category] = goods[i].categoryRus;
  }

  return category;
}

// создаём HTTP сервер, переданная функция будет реагировать на все запросы к нему
module.exports = server = createServer(async (req, res) => {
  // req - объект с информацией о запросе, res - объект для управления отправляемым ответом
  // чтобы не отклонять uri с img
  if (req.url.substring(1, 4) === "img") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    require("fs").readFile(`.${req.url}`, (err, image) => {
      res.end(image);
    });
    return;
  }

  // этот заголовок ответа указывает, что тело ответа будет в JSON формате
  res.setHeader("Content-Type", "application/json");

  // CORS заголовки ответа для поддержки кросс-доменных запросов из браузера
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // запрос с методом OPTIONS может отправлять браузер автоматически для проверки CORS заголовков
  // в этом случае достаточно ответить с пустым телом и этими заголовками
  if (req.method === "OPTIONS") {
    // end = закончить формировать ответ и отправить его клиенту
    res.end();
    return;
  }

  if (req.url.includes("/api/category")) {
    const body = await (async () => {
      if (req.method === "GET") return getCategory();
    })();
    res.end(JSON.stringify(body));
    return;
  }

  // если URI не начинается с нужного префикса - можем сразу отдать 404
  if (!req.url || !req.url.startsWith(URI_PREFIX)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not Found" }));
    return;
  }

  // убираем из запроса префикс URI, разбиваем его на путь и параметры
  const [uri, query] = req.url.substr(URI_PREFIX.length).split("?");
  const queryParams = {};
  // параметры могут отсутствовать вообще или иметь вид a=b&b=c
  // во втором случае наполняем объект queryParams { a: 'b', b: 'c' }
  if (query) {
    for (const piece of query.split("&")) {
      const [key, value] = piece.split("=");
      queryParams[key] = value ? decodeURIComponent(value) : "";
    }
  }

  try {
    // обрабатываем запрос и формируем тело ответа
    const body = await (async () => {
      if (uri === "" || uri === "/") {
        // /api/goods
        if (req.method === "GET") return getGoodsList(queryParams);
      } else {
        // /api/goods/{id}
        // параметр {id} из URI запроса
        const itemId = uri.substr(1);
        if (req.method === "GET") return getItems(itemId);
      }
      return null;
    })();
    res.end(JSON.stringify(body));
  } catch (err) {
    console.log("err: ", err);
    // обрабатываем сгенерированную нами же ошибку
    if (err instanceof ApiError) {
      res.writeHead(err.statusCode);
      res.end(JSON.stringify(err.data));
    } else {
      // если что-то пошло не так - пишем об этом в консоль и возвращаем 500 ошибку сервера
      res.statusCode = 500;
      res.end(JSON.stringify({ message: "Server Error" }));
    }
  }
})
  // выводим инструкцию, как только сервер запустился...
  .on("listening", () => {
    if (process.env.NODE_ENV !== "test") {
      console.log(
        `Сервер CRM запущен. Вы можете использовать его по адресу http://localhost:${PORT}`
      );
      console.log("Нажмите CTRL+C, чтобы остановить сервер");
      console.log("Доступные методы:");
      console.log(`GET /api/category - получить список категорий`);
      console.log(`GET ${URI_PREFIX} - получить список товаров`);
      console.log(`GET ${URI_PREFIX}/{id} - получить товар по его ID`);
      console.log(`GET ${URI_PREFIX}?{search=""} - найти товар по названию`);
      console.log(
        `GET ${URI_PREFIX}?{category=""&maxprice=""} - фильтрация
Параметры:
        category
        color
        minprice
        maxprice
        mindisplay
        maxdisplay`
      );
      console.log(
        `GET ${URI_PREFIX}?{list="{id},{id}"} - получить товары по id`
      );
    }
  })
  // ...и вызываем запуск сервера на указанном порту
  .listen(PORT);
