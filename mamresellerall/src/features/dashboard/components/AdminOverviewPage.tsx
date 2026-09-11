import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { apiFetch } from "@/lib/api";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Overview = {
  totals: { users: number; orders: number; revenue: number; fulfillment: number };
  daily: { date: string; orders: number; volume: number }[];
  bySupplier: { name: string; orders: number }[];
  byWeekday: { day: string; orders: number }[];
};

const areaConfig = {
  volume: { label: "Sales", color: "var(--chart-1)" },
} satisfies ChartConfig;

const pieColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const radarConfig = {
  orders: { label: "Orders", color: "var(--chart-2)" },
} satisfies ChartConfig;

const radialConfig = {
  fulfillment: { label: "Fulfillment", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Overview>("/api/admin/overview")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load overview"));
  }, []);

  const pieConfig = Object.fromEntries(
    (data?.bySupplier ?? []).map((s, i) => [s.name, { label: s.name, color: pieColors[i % pieColors.length] }]),
  ) satisfies ChartConfig;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { label: "Members", value: String(data.totals.users) },
              { label: "Orders", value: String(data.totals.orders) },
              { label: "Sales", value: fmtUSD.format(data.totals.revenue) },
              { label: "Fulfillment", value: `${data.totals.fulfillment}%` },
            ].map((s) => (
              <Card key={s.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{s.label}</CardDescription>
                  <CardTitle className="text-2xl">{s.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sales</CardTitle>
                <CardDescription>Last 14 days</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={areaConfig} className="h-64 w-full">
                  <AreaChart data={data.daily} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                    <Area dataKey="volume" type="natural" fill="var(--color-volume)" fillOpacity={0.2} stroke="var(--color-volume)" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orders per Supplier</CardTitle>
                <CardDescription>Distribution of all orders</CardDescription>
              </CardHeader>
              <CardContent>
                {data.bySupplier.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  <ChartContainer config={pieConfig} className="mx-auto h-64 w-full">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={data.bySupplier} dataKey="orders" nameKey="name" innerRadius={50} strokeWidth={4}>
                        {data.bySupplier.map((s, i) => (
                          <Pie key={s.name} data={[s]} dataKey="orders" nameKey="name" fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="name" />} className="flex-wrap" />
                    </PieChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orders by Day</CardTitle>
                <CardDescription>Which day of the week orders come in</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={radarConfig} className="mx-auto h-64 w-full">
                  <RadarChart data={data.byWeekday}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="day" />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Radar dataKey="orders" fill="var(--color-orders)" fillOpacity={0.3} stroke="var(--color-orders)" />
                  </RadarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fulfillment Rate</CardTitle>
                <CardDescription>Delivered vs total orders</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative mx-auto h-64 w-full">
                  <ChartContainer config={radialConfig} className="mx-auto h-64 w-full">
                    <RadialBarChart
                      data={[{ name: "Fulfillment", fulfillment: data.totals.fulfillment, fill: "var(--color-fulfillment)" }]}
                      startAngle={90}
                      endAngle={-270}
                      innerRadius={80}
                      outerRadius={110}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <RadialBar dataKey="fulfillment" cornerRadius={10} background />
                    </RadialBarChart>
                  </ChartContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold">{data.totals.fulfillment}%</span>
                    <span className="text-xs text-muted-foreground">{data.totals.orders} orders total</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
