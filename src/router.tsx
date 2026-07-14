import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Evita refetch redundante em cada navegação/foco. Mutações continuam
        // chamando invalidateQueries, então dados mudam quando devem — isto só
        // corta as re-buscas desnecessárias (ex.: papéis do usuário em toda tela).
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
