import { CheckoutOrder } from "./checkout-order";

type CheckoutPageProps = {
  searchParams: Promise<{ orderId?: string }>;
};

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const { orderId } = await searchParams;
  return <CheckoutOrder orderId={orderId ?? null} />;
}
