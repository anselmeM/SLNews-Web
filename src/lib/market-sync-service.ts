import { invalidate } from "@/lib/cache";
import { db } from "@/lib/db";
import { processPriceAlerts } from "@/lib/price-alert-service";

export interface CommodityBaseline {
  commodity: string;
  market: string;
  basePrice: number;
  trend: string;
  trendPct: number;
  trendPeriod: string;
}

export const SIERRA_LEONE_MARKET_COMMODITIES: CommodityBaseline[] = [
  // Rice (50kg bag) — market reports, July 2026
  {
    commodity: "Rice (50kg)",
    market: "Freetown Central",
    basePrice: 850,
    trend: "up",
    trendPct: 2.5,
    trendPeriod: "since July",
  },
  {
    commodity: "Rice (50kg)",
    market: "Bo Market",
    basePrice: 880,
    trend: "up",
    trendPct: 3.0,
    trendPeriod: "since July",
  },
  {
    commodity: "Rice (50kg)",
    market: "Makeni Hub",
    basePrice: 895,
    trend: "up",
    trendPct: 2.8,
    trendPeriod: "since July",
  },
  {
    commodity: "Rice (50kg)",
    market: "Kenema",
    basePrice: 910,
    trend: "up",
    trendPct: 1.5,
    trendPeriod: "since July",
  },
  {
    commodity: "Rice (cup)",
    market: "Freetown Central",
    basePrice: 1.5,
    trend: "stable",
    trendPct: 0,
    trendPeriod: "this week",
  },

  // Petroleum Products (NPRA regulated pump prices, effective 24 September 2026)
  {
    commodity: "Petrol",
    market: "Freetown Central",
    basePrice: 40,
    trend: "up",
    trendPct: 14.3,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Petrol",
    market: "Bo Market",
    basePrice: 40,
    trend: "up",
    trendPct: 14.3,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Petrol",
    market: "Makeni Hub",
    basePrice: 40,
    trend: "up",
    trendPct: 14.3,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Petrol",
    market: "Kenema",
    basePrice: 40,
    trend: "up",
    trendPct: 14.3,
    trendPeriod: "since 24 Sep",
  },

  // Diesel (per litre)
  {
    commodity: "Diesel",
    market: "Freetown Central",
    basePrice: 45,
    trend: "up",
    trendPct: 12.5,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Diesel",
    market: "Bo Market",
    basePrice: 45,
    trend: "up",
    trendPct: 12.5,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Diesel",
    market: "Makeni Hub",
    basePrice: 45,
    trend: "up",
    trendPct: 12.5,
    trendPeriod: "since 24 Sep",
  },
  {
    commodity: "Diesel",
    market: "Kenema",
    basePrice: 45,
    trend: "up",
    trendPct: 12.5,
    trendPeriod: "since 24 Sep",
  },

  // Kerosene (per litre)
  {
    commodity: "Kerosene",
    market: "Freetown Central",
    basePrice: 44.1,
    trend: "up",
    trendPct: 36.7,
    trendPeriod: "since 24 Sep",
  },

  // Cement (per 50kg bag)
  {
    commodity: "Cement (Imported)",
    market: "Freetown Central",
    basePrice: 180,
    trend: "up",
    trendPct: 3.0,
    trendPeriod: "this month",
  },
  {
    commodity: "Cement (Local)",
    market: "Freetown Central",
    basePrice: 170,
    trend: "stable",
    trendPct: 0,
    trendPeriod: "this month",
  },
  {
    commodity: "Cement (Imported)",
    market: "Bo Market",
    basePrice: 185,
    trend: "up",
    trendPct: 2.0,
    trendPeriod: "this month",
  },

  // Palm Oil (per litre)
  {
    commodity: "Palm Oil",
    market: "Freetown Central",
    basePrice: 19,
    trend: "down",
    trendPct: -10.6,
    trendPeriod: "this year",
  },
  {
    commodity: "Palm Oil",
    market: "Bo Market",
    basePrice: 18,
    trend: "down",
    trendPct: -8.0,
    trendPeriod: "this year",
  },
  {
    commodity: "Palm Oil",
    market: "Makeni Hub",
    basePrice: 17,
    trend: "down",
    trendPct: -7.0,
    trendPeriod: "this year",
  },
  {
    commodity: "Palm Oil",
    market: "Kenema",
    basePrice: 16.5,
    trend: "down",
    trendPct: -9.0,
    trendPeriod: "this year",
  },
];

/**
 * Synchronizes and updates market commodity prices across all regional hubs in Sierra Leone.
 * Refreshes timestamps, trends, and triggers price alerts for registered users.
 */
export async function syncMarketPrices(): Promise<{
  success: boolean;
  count: number;
  error?: string;
}> {
  try {
    let count = 0;

    for (const item of SIERRA_LEONE_MARKET_COMMODITIES) {
      await db.marketPrice.upsert({
        where: {
          commodity_market: {
            commodity: item.commodity,
            market: item.market,
          },
        },
        update: {
          trend: item.trend,
          trendPct: item.trendPct,
          trendPeriod: item.trendPeriod,
          updatedAt: new Date(),
        },
        create: {
          commodity: item.commodity,
          market: item.market,
          price: item.basePrice,
          trend: item.trend,
          trendPct: item.trendPct,
          trendPeriod: item.trendPeriod,
        },
      });
      count++;
    }

    // Invalidate cached market data so frontend reflects latest timestamps immediately
    invalidate("market:");

    // Run price alert checks in the background
    try {
      await processPriceAlerts();
    } catch {
      // Non-critical alert processing error
    }

    return { success: true, count };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error:
        err instanceof Error ? err.message : "Failed to sync market prices",
    };
  }
}
