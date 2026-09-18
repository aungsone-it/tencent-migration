import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { categoriesApi } from "../../utils/api";
import { useLanguage } from "../contexts/LanguageContext";

interface CategorySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function CategorySelect({ value, onValueChange, disabled }: CategorySelectProps) {
  const { t } = useLanguage();
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setIsLoading(true);
      const response = await categoriesApi.getAll();
      if (response && response.categories && Array.isArray(response.categories)) {
        // Get active category names
        const categoryNames = response.categories
          .filter((c: any) => c.status === "active")
          .map((c: any) => c.name);
        setCategories(categoryNames);
        console.log(`✅ Loaded ${categoryNames.length} categories for dropdown`);
      } else {
        setCategories([]);
      }
    } catch (error) {
      console.error("❌ Failed to load categories:", error);
      setCategories([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || isLoading || categories.length === 0}>
      <SelectTrigger className="mt-2">
        <SelectValue
          placeholder={
            isLoading
              ? t("addProduct.categoryPlaceholder")
              : categories.length === 0
                ? t("categories.noCategoriesFound")
                : t("addProduct.selectCategory")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {categories.length > 0 ? (
          categories.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))
        ) : (
          <SelectItem value="no-categories-available" disabled>
            {t("categories.noCategoriesFound")}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}