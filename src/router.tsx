import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { installStartupSafety } from "./lib/startupSafety";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  installStartupSafety();
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
