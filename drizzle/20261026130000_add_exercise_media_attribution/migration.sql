-- EN: Stores provenance for exercise demonstration images so attribution is generated from authoritative catalog data.
-- UK: Зберігає походження демонстраційних зображень вправ, щоб атрибуція формувалася з авторитетних даних каталогу.

ALTER TABLE "exercises" ADD COLUMN "demonstration_image_source_url" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "demonstration_image_author" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "demonstration_image_license" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "demonstration_image_license_url" text;
