-- Add image_url column to universities if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'universities'
      AND column_name = 'image_url'
  ) THEN
    ALTER TABLE "public"."universities"
      ADD COLUMN "image_url" TEXT;
  END IF;
END $$;









