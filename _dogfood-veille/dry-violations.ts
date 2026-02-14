// DRY violations — three copy-pasted filter/sort/format pipelines.
// Expected: cyclomatic warning on each, architectural DRY observation

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  score: number;
  department: string;
  createdAt: Date;
}

interface Product {
  id: number;
  title: string;
  sku: string;
  category: string;
  inStock: boolean;
  price: number;
  vendor: string;
  listedAt: Date;
}

interface Order {
  id: number;
  customer: string;
  reference: string;
  type: string;
  fulfilled: boolean;
  total: number;
  region: string;
  orderedAt: Date;
}

export function filterSortFormatUsers(
  users: User[],
  filters: { role?: string; active?: boolean; minScore?: number; department?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...users];

  if (filters.role) {
    result = result.filter(u => u.role === filters.role);
  }
  if (filters.active !== undefined) {
    result = result.filter(u => u.active === filters.active);
  }
  if (filters.minScore !== undefined) {
    result = result.filter(u => u.score >= filters.minScore!);
  }
  if (filters.department) {
    result = result.filter(u => u.department === filters.department);
  }

  if (sortBy === 'name') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  } else if (sortBy === 'score') {
    result.sort((a, b) => (sortOrder === 'asc' ? a.score - b.score : b.score - a.score));
  } else if (sortBy === 'createdAt') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
  } else if (sortBy === 'email') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.email.localeCompare(b.email) : b.email.localeCompare(a.email),
    );
  } else if (sortBy === 'department') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.department.localeCompare(b.department)
        : b.department.localeCompare(a.department),
    );
  }

  return result.map(u => {
    if (u.active) {
      return `[ACTIVE] ${u.name} (${u.role}) - ${u.department} - Score: ${u.score}`;
    } else {
      return `[INACTIVE] ${u.name} (${u.role}) - ${u.department}`;
    }
  });
}

export function filterSortFormatProducts(
  products: Product[],
  filters: { category?: string; inStock?: boolean; minPrice?: number; vendor?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...products];

  if (filters.category) {
    result = result.filter(p => p.category === filters.category);
  }
  if (filters.inStock !== undefined) {
    result = result.filter(p => p.inStock === filters.inStock);
  }
  if (filters.minPrice !== undefined) {
    result = result.filter(p => p.price >= filters.minPrice!);
  }
  if (filters.vendor) {
    result = result.filter(p => p.vendor === filters.vendor);
  }

  if (sortBy === 'title') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
    );
  } else if (sortBy === 'price') {
    result.sort((a, b) => (sortOrder === 'asc' ? a.price - b.price : b.price - a.price));
  } else if (sortBy === 'listedAt') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.listedAt.getTime() - b.listedAt.getTime()
        : b.listedAt.getTime() - a.listedAt.getTime(),
    );
  } else if (sortBy === 'sku') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.sku.localeCompare(b.sku) : b.sku.localeCompare(a.sku),
    );
  } else if (sortBy === 'vendor') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.vendor.localeCompare(b.vendor) : b.vendor.localeCompare(a.vendor),
    );
  }

  return result.map(p => {
    if (p.inStock) {
      return `[IN STOCK] ${p.title} (${p.category}) - ${p.vendor} - $${p.price.toFixed(2)}`;
    } else {
      return `[OUT OF STOCK] ${p.title} (${p.category}) - ${p.vendor}`;
    }
  });
}

export function filterSortFormatOrders(
  orders: Order[],
  filters: { type?: string; fulfilled?: boolean; minTotal?: number; region?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...orders];

  if (filters.type) {
    result = result.filter(o => o.type === filters.type);
  }
  if (filters.fulfilled !== undefined) {
    result = result.filter(o => o.fulfilled === filters.fulfilled);
  }
  if (filters.minTotal !== undefined) {
    result = result.filter(o => o.total >= filters.minTotal!);
  }
  if (filters.region) {
    result = result.filter(o => o.region === filters.region);
  }

  if (sortBy === 'customer') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.customer.localeCompare(b.customer)
        : b.customer.localeCompare(a.customer),
    );
  } else if (sortBy === 'total') {
    result.sort((a, b) => (sortOrder === 'asc' ? a.total - b.total : b.total - a.total));
  } else if (sortBy === 'orderedAt') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.orderedAt.getTime() - b.orderedAt.getTime()
        : b.orderedAt.getTime() - a.orderedAt.getTime(),
    );
  } else if (sortBy === 'reference') {
    result.sort((a, b) =>
      sortOrder === 'asc'
        ? a.reference.localeCompare(b.reference)
        : b.reference.localeCompare(a.reference),
    );
  } else if (sortBy === 'region') {
    result.sort((a, b) =>
      sortOrder === 'asc' ? a.region.localeCompare(b.region) : b.region.localeCompare(a.region),
    );
  }

  return result.map(o => {
    if (o.fulfilled) {
      return `[FULFILLED] ${o.customer} (${o.type}) - ${o.region} - $${o.total.toFixed(2)}`;
    } else {
      return `[PENDING] ${o.customer} (${o.type}) - ${o.region}`;
    }
  });
}
