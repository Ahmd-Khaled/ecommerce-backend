import { dashboardRepository } from '../../DB/repository/dashboard.repository';
import { reportingRepository } from '../../DB/repository/reporting.repository';
import { storeMoney } from '../../Utils/money';
import { lowStockThreshold } from './dashboard.config';
import type { OverviewDTO, SalesDTO, TopProductsDTO } from './dashboard.dto';

const reporting = { basis: 'paid-sales', timezone: 'UTC', refundsTracked: false,
  limitation: 'Refunds and returns are not recorded. External refunds cannot be excluded; these figures are not net accounting revenue.' };
export const dashboardService = {
  async overview(query: OverviewDTO) {
    const threshold = lowStockThreshold();
    const [overview, paidSales] = await Promise.all([
      dashboardRepository.overview(query, threshold), reportingRepository.sales(query),
    ]);
    return { ...overview, period: query, paidSales, lowStockThreshold: threshold,
      catalogCurrency: storeMoney(), reporting };
  },
  async sales(query: SalesDTO) {
    return { period: { from: query.from, to: query.to }, groupBy: query.groupBy,
      series: await reportingRepository.sales(query, query.groupBy), reporting };
  },
  async topProducts(query: TopProductsDTO) {
    return { ...await reportingRepository.topProducts(query, query.page, query.limit, query.currency),
      period: { from: query.from, to: query.to }, reporting,
      lineSalesBasis: 'Stored item totals before order-level discounts, tax and shipping; not allocated payment revenue.' };
  },
};
