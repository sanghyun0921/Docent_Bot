#include "tb3_standalone_nav/costmap/dynamic_obstacle_layer.hpp"
#include <cmath>

namespace tb3_standalone_nav
{
namespace costmap
{

DynamicObstacleLayer::DynamicObstacleLayer()
{
}

void DynamicObstacleLayer::updateCosts(
  Costmap2D& master_grid, 
  const std::vector<DynamicObstacle>& obstacles,
  double prediction_time,
  double dt)
{
  for (const auto& obs : obstacles) {
    double t = 0.0;
    while (t <= prediction_time) {
      // Constant Velocity (CV) Prediction step
      double px = obs.x + obs.vx * t;
      double py = obs.y + obs.vy * t;
      
      unsigned int mx, my;
      if (master_grid.worldToMap(px, py, mx, my)) {
        // Apply temporal decay to cost (future points are slightly less lethal or have smaller radius)
        unsigned char cost = costmap::LETHAL_OBSTACLE;
        master_grid.setCost(mx, my, cost);
      }
      t += dt;
    }
  }
}

}  // namespace costmap
}  // namespace tb3_standalone_nav
