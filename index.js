import { log } from "node:console";
import { readFileSync, readFile, writeFile } from "node:fs";
import { createServer } from "node:http";
import path from "path";
import * as url from "url";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const DB_FILE = path.resolve(__dirname, "db.json");
const ORDER_FILE = path.resolve(__dirname, "order.json");
const PORT = process.env.PORT || 8024;
const URI_PREFIX = "/api/goods";

const db = JSON.parse(readFileSync(DB_FILE) || "[]");
const orders = JSON.parse(readFileSync(ORDER_FILE) || "[]");

const drainJson = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      resolve(JSON.parse(data));
    });
  });

class ApiError extends Error {
  constructor(statusCode, data) {
    super();
    this.statusCode = statusCode;
    this.data = data;
  }
}

const createOrder = (data) => {
  if (!data.order.length)
    throw new ApiError(500, { message: "Order is empty" });

  data.id = Math.random().toString(10).substring(2, 5);
  data.createdAt = new Date().toGMTString();

  data.totalPrice = data.order.reduce((acc, item) => {
    const product = db.goods.find((product) => item.id === product.id);
    return acc + item.count * product.price;
  }, 0);

  orders.push(data);
  writeFile(ORDER_FILE, JSON.stringify(orders), (err) => {
    if (err) throw err;
    console.log("Orders has been saved!");
  });

  return data;
};

const shuffle = (array) => {
  const shuffleArray = [...array];
  for (let i = shuffleArray.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [shuffleArray[i], shuffleArray[j]] = [shuffleArray[j], shuffleArray[i]];
  }

  return shuffleArray;
};

const pagination = (data, page, count) => {
  const end = count * page;
  const start = page === 1 ? 0 : end - count;
  const totalCount = data.length;

  const pages = Math.ceil(data.length / count);

  return {
    goods: data.slice(start, end),
    page,
    pages,
    totalCount,
  };
};

const getGoodsList = (params) => {
  const keys = Object.keys(params);
  if (keys.length) {
    const isKeys = keys.every((item) =>
      [
        "page",
        "count",
        "gender",
        "category",
        "type",
        "search",
        "list",
        "top",
        "exclude",
      ].includes(item)
    );

    if (!isKeys) {
      throw new ApiError(403, { message: "Fail Params" });
    }
  }

  const page = +params.page || 1;
  let paginationCount = +params.count || 12;

  let data = [...db.goods];

  if (params.gender) {
    if (params.gender === "all") {
      paginationCount = +params.count || 4;
    } else {
      data = data.filter((item) => item.gender === params.gender);
      paginationCount = +params.count || 8;
    }

    if (!params.category) {
      data = data.filter((item) => item.top);
      data = shuffle(data);
      if (paginationCount < data.length) {
        data.length = paginationCount;
      }

      return data;
    }
  }

  if (params.category) {
    if (!params.gender) {
      throw new ApiError(403, { message: "Not gender params" });
    }
    if (params.top) {
      data = data.filter(
        (item) =>
          item.top &&
          item.category === params.category &&
          item.id !== params.exclude
      );
      data = shuffle(data);
      if (paginationCount < data.length) {
        data.length = paginationCount;
      }
    }

    data = data.filter((item) => item.category === params.category);
  }

  if (params.type) {
    data = data.filter((item) => item.type === params.type);
  }

  if (params.search) {
    const search = params.search.replaceAll("+", " ").trim().toLowerCase();
    data = db.goods.filter((item) => {
      return (
        item.title.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search)
      );
    });
  }

  if (params.list || Object.hasOwn(params, "list")) {
    const list = params.list.trim().toLowerCase();
    data = db.goods.filter((item) => list.includes(item.id)).reverse();
  }

  if (params.count === "all") {
    return data;
  }

  return pagination(data, page, paginationCount);
};

const getItems = (itemId) => {
  const item = db.goods.find(({ id }) => id === itemId);
  if (!item) throw new ApiError(404, { message: "Item Not Found" });
  return item;
};

createServer(async (req, res) => {
  // CORS заголовки ответа для поддержки кросс-доменных запросов из браузера
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // req - объект с информацией о запросе, res - объект для управления отправляемым ответом
  // чтобы не отклонять uri с img
  if (req.url.substring(1, 4) === "img") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    readFile(`${__dirname}${req.url}`, (err, image) => {
      res.end(image);
    });
    return;
  }

  // этот заголовок ответа указывает, что тело ответа будет в JSON формате
  res.setHeader("Content-Type", "application/json");

  // запрос с методом OPTIONS может отправлять браузер автоматически для проверки CORS заголовков
  // в этом случае достаточно ответить с пустым телом и этими заголовками
  if (req.method === "OPTIONS") {
    // end = закончить формировать ответ и отправить его клиенту
    res.end();
    return;
  }

  if (req.url.includes("/api/categories")) {
    res.end(JSON.stringify(db.categories));
    return;
  }

  if (req.url.includes("/api/colors")) {
    res.end(JSON.stringify(db.colors));
    return;
  }
  try {
    if (req.method === "POST" && req.url === "/api/order") {
      const order = createOrder(await drainJson(req));
      res.statusCode = 201;
      res.setHeader("Access-Control-Expose-Headers", "Location");
      res.setHeader("Location", `api/order/${order.id}`);
      res.end(JSON.stringify(order));
      return;
    }
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
  // если URI не начинается с нужного префикса - можем сразу отдать 404
  if (!req.url || !req.url.startsWith(URI_PREFIX)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not Found" }));
    return;
  }

  // убираем из запроса префикс URI, разбиваем его на путь и параметры
  const [uri, query] = req.url.substring(URI_PREFIX.length).split("?");
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

    const body = await (() => {
      const postPrefix = uri.substring(1);

      if (req.method !== "GET") return;
      if (uri === "" || uri === "/") {
        // /api/goods
        return getGoodsList(queryParams);
      }
      // /api/goods/{id}
      // параметр {id} из URI запроса

      return getItems(postPrefix);
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
        `Сервер Inspired запущен. Вы можете использовать его по адресу http://localhost:${PORT}`
      );
      console.log("Нажмите CTRL+C, чтобы остановить сервер");
      console.log("Доступные методы:");
      console.log(
        `GET ${URI_PREFIX} - получить список всех товаров с пагинацией`
      );
      console.log(`GET ${URI_PREFIX}/{id} - получить товар по его ID`);
      console.log(`GET /api/categories - получить список категорий`);
      console.log(`GET /api/colors - получить список цветов`);
      console.log(
        `GET ${URI_PREFIX}?[param]
Параметры:
        gender
        category&gender
        search = поиск
        count = количество товаров (12)
        page = страница (1)
        list={id},{id} - получить список товаров по id
        exclude=id - исключить id
        top=true - топ товары
        `
      );
      console.log(
        `POST /api/order - оформить заказ (
          {
            fio: str,
            address?: str,
            phone: str,
            email: str,
            delivery: bool,
            goods: [{id, count}]
          })
          no validate`
      );
      console.log("Update 15/07/2023 add preload fetch image");
      console.log(`Happy Coding 🎉`);
    }
  })
  .listen(PORT);
