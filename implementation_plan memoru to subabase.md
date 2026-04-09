# 🚀 خطة نقل الذاكرة من ChromaDB إلى Supabase pgvector

## الهدف

نقل تخزين الذكريات من **ChromaDB المحلي** (اللي بيضيع مع كل deploy) إلى **Supabase PostgreSQL + pgvector** (تخزين دائم سحابي).

## لماذا Supabase؟
- أنتم **أصلاً بتستخدموا Supabase** للـ Auth والتخزين
- مجاني ضمن خطتكم الحالية
- البيانات **مش هتضيع أبداً**
- أسرع من ChromaDB على السيرفر

---

## User Review Required

> [!IMPORTANT]
> **الخطوة الأولى (إنشاء الجدول والـ SQL Functions) لازم تتعمل يدوياً من Supabase Dashboard.**
> هل أنت عندك صلاحية الدخول على Supabase Dashboard؟

> [!WARNING]
> بعد التحويل، الذكريات القديمة في `chroma_db/` **مش هتنتقل تلقائياً**. لو عايز تنقلها ممكن نعمل script للنقل.

---

## Proposed Changes

### الخطوة 1: إعداد Supabase (يدوي — من الـ Dashboard)

ادخل على https://supabase.com/dashboard → Project → **SQL Editor** وشغّل الأوامر دي بالترتيب:

#### 1.1 تفعيل pgvector Extension:
```sql
create extension if not exists vector;
```

#### 1.2 إنشاء جدول `memories`:
```sql
create table if not exists memories (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  memory_text text not null,
  categories text[] default '{}',
  date text not null,
  embedding vector(384),   -- MiniLM-L6-v2 يُنتج 384 بُعد
  created_at timestamptz default now()
);

-- Index للبحث السريع بالـ user_id
create index if not exists idx_memories_user_id on memories(user_id);

-- Index للبحث بالـ vectors (HNSW — أسرع من IVFFlat)
create index if not exists idx_memories_embedding on memories 
  using hnsw (embedding vector_cosine_ops);
```

#### 1.3 إنشاء Function للبحث بالتشابه:
```sql
create or replace function match_memories(
  query_embedding vector(384),
  match_user_id text,
  match_count int default 2
)
returns table (
  id uuid,
  user_id text,
  memory_text text,
  categories text[],
  date text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    m.id,
    m.user_id,
    m.memory_text,
    m.categories,
    m.date,
    1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.user_id = match_user_id
  order by m.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

---

### الخطوة 2: تعديل الكود

#### [MODIFY] [vectordb.py](file:///c:/Users/Administrator/Desktop/For Team/backend/memory/vectordb.py)

استبدال **كامل** للملف — من ChromaDB إلى Supabase. نفس الـ interface (نفس أسماء الوظائف) عشان باقي الملفات **مش محتاجة تتغير**.

#### [MODIFY] [requirements.txt](file:///c:/Users/Administrator/Desktop/For Team/requirements.txt)

إضافة `supabase` (موجود) + `huggingface_hub` (ناقص) + إزالة `chromadb` (مش محتاجينه).

#### [MODIFY] [view_memories.py](file:///c:/Users/Administrator/Desktop/For Team/view_memories.py)

تحديث أداة عرض الذكريات لتستخدم Supabase بدل ChromaDB.

---

### الخطوة 3: لا تغييرات مطلوبة في هذه الملفات ✅

بما إننا هنحافظ على **نفس الـ interface** (نفس أسماء الوظائف ونفس الـ Models):

| الملف | السبب |
|-------|-------|
| `memory_manager.py` | بيستدعي `search_memories()` و `update_memories()` — مش هتتغير |
| `update_memory.py` | بيستدعي `insert_memories()` و `delete_records()` — مش هتتغير |
| `generate_embeddings.py` | مش مرتبط بقاعدة البيانات أصلاً |
| `llm_manager.py` | بيتعامل مع `MemoryManager` فقط — مش هيتأثر |
| `app.py` | بيتعامل مع `LLMManager` فقط — مش هيتأثر |

---

## Open Questions

> [!IMPORTANT]
> 1. **هل عندك صلاحية دخول Supabase Dashboard؟** (عشان تشغّل الـ SQL)
> 2. **هل عايز تحتفظ بـ ChromaDB كـ fallback محلي؟** (يعني لو Supabase مش متاح يستخدم ChromaDB)
> 3. **هل عايز تنقل الذكريات القديمة من `chroma_db/` لـ Supabase؟**

---

## Verification Plan

### Automated Tests
1. تشغيل السيرفر محلياً: `uvicorn backend.app:app`
2. إرسال رسالة شات مع `user_id` والتأكد إن الذاكرة اتحفظت
3. تشغيل `view_memories.py` للتأكد إن البيانات ظاهرة
4. فتح Supabase Dashboard → Table Editor → memories → التأكد إن الصفوف موجودة

### Manual Verification
- التأكد من Supabase Dashboard إن الجدول اتعمل والبيانات بتتحفظ
