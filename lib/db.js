// 데이터 저장소 어댑터
// - 로컬 개발: data.json 파일에 읽고 쓴다 (기존 방식 그대로).
// - Vercel 배포: Redis(Upstash, Vercel Marketplace의 "Upstash Redis" 통합)에
//   하나의 키로 전체 데이터를 저장한다. 서버리스 환경은 파일시스템 쓰기가
//   지속되지 않기 때문이다.
// 데이터 형태(members/schedules/recurringRules/memos)는 기존과 동일하게 유지한다.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data.json');
const DATA_EXAMPLE_PATH = path.join(__dirname, '..', 'data.example.json');
const REDIS_KEY = 'familyboard:data';

// Vercel의 "Upstash Redis" 통합이 붙이는 환경변수 이름은 상황에 따라
// UPSTASH_REDIS_REST_* 또는 (구 Vercel KV 호환) KV_REST_API_* 로 나타날 수 있어
// 둘 다 확인한다.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

let redis = null;
if (useRedis) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

function normalize(data) {
  if (!Array.isArray(data.members)) data.members = [];
  if (!Array.isArray(data.schedules)) data.schedules = [];
  if (!Array.isArray(data.recurringRules)) data.recurringRules = [];
  if (!Array.isArray(data.memos)) data.memos = [];
  return data;
}

function loadExample() {
  if (fs.existsSync(DATA_EXAMPLE_PATH)) {
    return normalize(JSON.parse(fs.readFileSync(DATA_EXAMPLE_PATH, 'utf-8')));
  }
  return normalize({});
}

// ---- 파일 기반 저장 (로컬 개발용, 쓰기 요청은 순차 처리) ----
let writeChain = Promise.resolve();

function ensureLocalFile() {
  if (!fs.existsSync(DATA_PATH) && fs.existsSync(DATA_EXAMPLE_PATH)) {
    fs.copyFileSync(DATA_EXAMPLE_PATH, DATA_PATH);
  }
}

async function readFromFile() {
  ensureLocalFile();
  const raw = await fsp.readFile(DATA_PATH, 'utf-8');
  return normalize(JSON.parse(raw));
}

function saveToFile(data) {
  writeChain = writeChain.then(() =>
    fsp.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8')
  );
  return writeChain;
}

// ---- Redis(KV) 기반 저장 (배포 환경용) ----
async function readFromRedis() {
  const data = await redis.get(REDIS_KEY);
  if (!data) {
    const seed = loadExample();
    await redis.set(REDIS_KEY, seed);
    return seed;
  }
  return normalize(data);
}

function saveToRedis(data) {
  return redis.set(REDIS_KEY, data);
}

async function readData() {
  return useRedis ? readFromRedis() : readFromFile();
}

function saveData(data) {
  return useRedis ? saveToRedis(data) : saveToFile(data);
}

module.exports = { readData, saveData, useRedis };
