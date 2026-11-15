import { homeRepository } from '../../DB/repository/home.repository';
import { bannerService } from '../banner/banner.service';
import { categoryService } from '../category/category.service';
import type { Language } from '../../Utils/i18n';
import type { HomeDTO } from './home.dto';

export const homeService = {
  products: homeRepository.products,
  async overview(query: HomeDTO, language: Language) {
    const { view, limit } = query;
    const [banners, categories, latest, offers, sellers] = await Promise.all([
      bannerService.publicList({ view, page: 1, limit }, language),
      categoryService.getRootCategories({ page: 1, limit, sortBy: 'sortOrder', sortOrder: 'asc' }),
      homeRepository.products({ section: 'latest', page: 1, limit }),
      homeRepository.products({ section: 'best-offers', page: 1, limit }),
      homeRepository.products({ section: 'best-sellers', page: 1, limit }),
    ]);
    return { language, view, currency: latest.currency, currencyExponent: latest.currencyExponent,
      banners: banners.banners, categories: categories.categories, latestProducts: latest.products,
      bestOffers: offers.products, bestDeal: offers.products[0] ?? null, bestSellers: sellers.products };
  },
};
